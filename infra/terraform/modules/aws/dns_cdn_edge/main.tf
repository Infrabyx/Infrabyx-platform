resource "aws_route53_zone" "this" {
  name          = var.domain
  comment       = "${var.name}; the edge (Cloudflare) fronts origin.${var.domain}"
  force_destroy = false
  tags          = var.tags
}
