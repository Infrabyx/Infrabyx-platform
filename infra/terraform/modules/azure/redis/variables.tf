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

variable "resource_group_name" {
  type = string
}

variable "location" {
  description = "Primary region (centralindia unless an ADR says otherwise)"
  type        = string
}

variable "vnet_id" {
  type = string
}

variable "subnet_id" {
  description = "The private endpoint subnet"
  type        = string
}

variable "capacity" {
  description = "Premium size (P1 = 6 GB)"
  type        = number
  default     = 1
}

variable "secrets_path_prefix" {
  description = "Secret name prefix, for example secrets-prod"
  type        = string
}

variable "zones" {
  description = "Availability zones in the primary region"
  type        = list(string)
  default     = ["1", "2", "3"]
}
