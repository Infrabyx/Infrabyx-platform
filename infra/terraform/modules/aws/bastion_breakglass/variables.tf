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

variable "enabled" {
  description = "Create the break-glass role (off by default; IPB-02 break-glass procedure)"
  type        = bool
  default     = false
}

variable "trusted_principal_arns" {
  description = "Principals allowed to assume the role, with MFA"
  type        = list(string)
  default     = []
}
