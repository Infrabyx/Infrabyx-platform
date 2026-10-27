# The product's public zone (IPB-01 §01.4.12). Cloudflare is the edge in front of the origin and is
# configured by the product; this module holds only the zone the origin record lives in.
resource "azurerm_dns_zone" "this" {
  name                = var.domain
  resource_group_name = var.resource_group_name
  tags                = var.tags
}
