# Azure Cache for Redis Premium across three zones (IPB-01 §01.4.9.1): reachable only through a
# private endpoint, TLS 1.2 or later, Entra ID authentication with the access keys turned off.
# Redis 6 is the newest version Azure Cache offers (PL6-D-06).
resource "azurerm_redis_cache" "this" {
  name                               = var.name
  location                           = var.location
  resource_group_name                = var.resource_group_name
  sku_name                           = "Premium"
  family                             = "P"
  capacity                           = var.capacity
  redis_version                      = "6"
  zones                              = var.zones
  non_ssl_port_enabled               = false
  minimum_tls_version                = "1.2"
  public_network_access_enabled      = false
  access_keys_authentication_enabled = false
  redis_configuration {
    active_directory_authentication_enabled = true
  }
  tags = var.tags
}

resource "azurerm_private_dns_zone" "this" {
  name                = "privatelink.redis.cache.windows.net"
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "this" {
  name                = "${var.name}-redis"
  private_dns_zone_id = azurerm_private_dns_zone.this.id
  virtual_network_id  = var.vnet_id
  tags                = var.tags
}

resource "azurerm_private_endpoint" "this" {
  name                = "${var.name}-redis"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = var.subnet_id
  private_service_connection {
    name                           = "redis"
    private_connection_resource_id = azurerm_redis_cache.this.id
    subresource_names              = ["redisCache"]
    is_manual_connection           = false
  }
  private_dns_zone_group {
    name                 = "redis"
    private_dns_zone_ids = [azurerm_private_dns_zone.this.id]
  }
  tags = var.tags
}
