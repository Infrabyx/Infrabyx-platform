# PostgreSQL 18 on Flexible Server (IPB-01 §01.4.9.1): injected into the delegated subnet with no
# public access, Entra ID authentication only (no password exists, so none is in state), TLS 1.2
# or later (verify-full in the apps), the platform key, geo-redundant backups for the DR region,
# and a delete lock.
resource "azurerm_private_dns_zone" "this" {
  name                = "${replace(var.name, "infrabyx-", "ibx-")}.postgres.database.azure.com"
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "this" {
  name                = "${var.name}-postgres"
  private_dns_zone_id = azurerm_private_dns_zone.this.id
  virtual_network_id  = var.vnet_id
  tags                = var.tags
}

# Entra administrator of the server: the database bootstrap runs as this identity and creates the
# application roles (IPB-01 §01.4.4).
resource "azurerm_user_assigned_identity" "admin" {
  name                = "${var.name}-pg-admin"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_postgresql_flexible_server" "this" {
  name                          = var.name
  location                      = var.location
  resource_group_name           = var.resource_group_name
  version                       = "18"
  sku_name                      = var.sku_name
  storage_mb                    = var.storage_mb
  auto_grow_enabled             = true
  zone                          = var.zones[0]
  delegated_subnet_id           = var.subnet_id
  private_dns_zone_id           = azurerm_private_dns_zone.this.id
  public_network_access_enabled = false
  backup_retention_days         = var.backup_retention_days
  geo_redundant_backup_enabled  = true
  authentication {
    active_directory_auth_enabled = true
    password_auth_enabled         = false
    tenant_id                     = var.tenant_id
  }
  identity {
    type         = "UserAssigned"
    identity_ids = [var.cmk_identity_id]
  }
  customer_managed_key {
    key_vault_key_id                     = var.key_id
    primary_user_assigned_identity_id    = var.cmk_identity_id
    geo_backup_key_vault_key_id          = var.dr_key_id
    geo_backup_user_assigned_identity_id = var.cmk_identity_id
  }
  dynamic "high_availability" {
    for_each = var.high_availability ? [1] : []
    content {
      mode                      = "ZoneRedundant"
      standby_availability_zone = var.zones[1]
    }
  }
  tags       = var.tags
  depends_on = [azurerm_private_dns_zone_virtual_network_link.this]
}

resource "azurerm_postgresql_flexible_server_active_directory_administrator" "this" {
  server_name         = azurerm_postgresql_flexible_server.this.name
  resource_group_name = var.resource_group_name
  tenant_id           = var.tenant_id
  object_id           = azurerm_user_assigned_identity.admin.principal_id
  principal_name      = azurerm_user_assigned_identity.admin.name
  principal_type      = "ServicePrincipal"
}

resource "azurerm_postgresql_flexible_server_configuration" "this" {
  for_each = {
    require_secure_transport     = "on"
    ssl_min_protocol_version     = "TLSv1.2"
    log_min_duration_statement   = "1000"
    log_connections              = "on"
    log_disconnections           = "on"
    log_checkpoints              = "on"
    "connection_throttle.enable" = "on"
  }
  name      = each.key
  server_id = azurerm_postgresql_flexible_server.this.id
  value     = each.value
}

resource "azurerm_postgresql_flexible_server_database" "this" {
  name      = var.db_name
  server_id = azurerm_postgresql_flexible_server.this.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

resource "azurerm_management_lock" "this" {
  name       = "${var.name}-postgres"
  scope      = azurerm_postgresql_flexible_server.this.id
  lock_level = "CanNotDelete"
  notes      = "Deletion protection (IPB-01 §01.4.9.1)"
}
