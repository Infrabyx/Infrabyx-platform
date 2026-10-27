variable "name" {
  description = "Resource name prefix: infrabyx-<product>-<env>"
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,40}$", var.name))
    error_message = "name is lower-case letters, digits and hyphens, 3 to 41 characters."
  }
}

variable "tags" {
  description = "Labels on every resource (product, env, data class); lower-case values"
  type        = map(string)
  default     = {}
}

variable "region" {
  description = "Primary region (asia-south1 unless an ADR says otherwise)"
  type        = string
}

variable "zones" {
  description = "Zones of the primary and the replica"
  type        = list(string)
}

variable "network_id" {
  type = string
}

variable "key_id" {
  type = string
}

variable "memory_size_gb" {
  type    = number
  default = 5
}

variable "secrets_path_prefix" {
  description = "Secret id prefix, for example secrets-prod"
  type        = string
}
