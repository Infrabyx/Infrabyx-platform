variable "name" {
  description = "Resource name prefix: infrabyx-<product>-<env>"
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,40}$", var.name))
    error_message = "name is lower-case letters, digits and hyphens, 3 to 41 characters."
  }
}

variable "tags" {
  description = "Tags on every resource (product, env, data class)"
  type        = map(string)
  default     = {}
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
