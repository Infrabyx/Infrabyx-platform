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

variable "region_dr" {
  description = "Where the backups are kept"
  type        = string
}

variable "db_name" {
  description = "Database name (the product code)"
  type        = string
}

variable "network_id" {
  type = string
}

variable "key_id" {
  type = string
}

variable "tier" {
  type    = string
  default = "db-custom-4-16384"
}

variable "disk_size_gb" {
  type    = number
  default = 100
}

variable "high_availability" {
  description = "Regional (two-zone) instance (required in prod)"
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  type    = number
  default = 35
}

variable "secrets_path_prefix" {
  description = "Secret id prefix, for example secrets-prod"
  type        = string
}
