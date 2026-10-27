# Azure Container Registry Premium (IPB-01 §01.4.9.1): Entra ID only (no admin user, no anonymous
# pull), zone-redundant with a geo-replica in the DR region, encrypted with the platform key, and
# untagged manifests purged. ACR has no registry-wide immutable tags; the release job locks each
# promoted tag (write-enabled false), and the chart deploys by digest only.
resource "azurerm_container_registry" "this" {
  name                          = "${replace(replace(var.name, "infrabyx-", "ibx"), "-", "")}acr"
  resource_group_name           = var.resource_group_name
  location                      = var.location
  sku                           = "Premium"
  admin_enabled                 = false
  anonymous_pull_enabled        = false
  public_network_access_enabled = true
  zone_redundancy_enabled       = true
  data_endpoint_enabled         = true
  retention_policy_in_days      = var.untagged_retention_days
  georeplications {
    location                        = var.location_dr
    zone_redundancy_enabled         = true
    global_endpoint_routing_enabled = true
    tags                            = var.tags
  }
  identity {
    type         = "UserAssigned"
    identity_ids = [var.cmk_identity_id]
  }
  encryption {
    key_vault_key_id   = var.key_id
    identity_client_id = var.cmk_identity_client_id
  }
  tags = var.tags
}

resource "azurerm_role_assignment" "pull" {
  for_each             = var.pull_principal_ids
  scope                = azurerm_container_registry.this.id
  role_definition_name = "AcrPull"
  principal_id         = each.value
  principal_type       = "ServicePrincipal"
}
