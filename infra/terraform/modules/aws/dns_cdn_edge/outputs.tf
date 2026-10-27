output "zone_id" {
  value = aws_route53_zone.this.zone_id
}

output "origin_hostname" {
  value = "${var.origin_label}.${var.domain}"
}
