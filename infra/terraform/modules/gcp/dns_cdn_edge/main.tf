# The product's public zone with DNSSEC (IPB-01 §01.4.12). Cloudflare is the edge in front of the
# origin and is configured by the product; this module holds only the zone.
resource "google_dns_managed_zone" "this" {
  name        = var.name
  dns_name    = "${var.domain}."
  description = "Public zone of ${var.name}"
  visibility  = "public"
  labels      = var.tags
  dnssec_config {
    state         = "on"
    non_existence = "nsec3"
  }
}
