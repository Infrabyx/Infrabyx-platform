output "zone_id" {
  value = azurerm_dns_zone.this.id
}

output "origin_hostname" {
  value = "${var.origin_label}.${var.domain}"
}
