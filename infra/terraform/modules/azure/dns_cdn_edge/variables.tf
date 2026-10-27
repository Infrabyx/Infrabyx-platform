variable "tags" {
  description = "Tags on every resource (product, env, data class)"
  type        = map(string)
  default     = {}
}

variable "resource_group_name" {
  type = string
}

variable "domain" {
  description = "The product's DNS zone, for example app.example.test"
  type        = string
}

variable "origin_label" {
  description = "Host label of the origin behind the edge (Cloudflare in front, IPB-01 §01.4.12)"
  type        = string
  default     = "origin"
}
