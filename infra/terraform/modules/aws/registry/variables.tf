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

variable "repositories" {
  description = "Image repositories, one per deployable (api, worker, web, public, console)"
  type        = list(string)
  default     = ["api", "worker", "web", "public", "console"]
}

variable "kms_key_arn" {
  type = string
}
