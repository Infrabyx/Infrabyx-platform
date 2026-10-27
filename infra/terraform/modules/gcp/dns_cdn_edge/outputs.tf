output "zone_id" {
  value = google_dns_managed_zone.this.id
}

output "origin_hostname" {
  value = "${var.origin_label}.${var.domain}"
}
