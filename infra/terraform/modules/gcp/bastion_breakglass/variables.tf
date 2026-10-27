variable "name" {
  description = "Resource name prefix: infrabyx-<product>-<env>"
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,40}$", var.name))
    error_message = "name is lower-case letters, digits and hyphens, 3 to 41 characters."
  }
}


variable "enabled" {
  description = "Turn on only for an incident, and off again after it"
  type        = bool
  default     = false
}

variable "members" {
  description = "Name => IAM member allowed in (group:responders@example.test; MFA is enforced by the organisation)"
  type        = map(string)
  default     = {}
}

variable "expires_at" {
  description = "RFC 3339 time the grant stops working; required when enabled"
  type        = string
  default     = ""
  validation {
    condition     = var.expires_at == "" || can(formatdate("YYYY", var.expires_at))
    error_message = "expires_at is an RFC 3339 timestamp such as 2026-11-01T12:00:00Z."
  }
}
