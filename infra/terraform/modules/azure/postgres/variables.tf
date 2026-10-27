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

variable "db_name" {
  description = "Database name (the product code)"
  type        = string
}

variable "vnet_id" {
  type = string
}

variable "subnet_id" {
  description = "The subnet delegated to Microsoft.DBforPostgreSQL/flexibleServers"
  type        = string
}

variable "key_id" {
  description = "The platform key (versionless id)"
  type        = string
}

variable "dr_key_id" {
  description = "The DR region's platform key, for the geo-redundant backups"
  type        = string
}

variable "cmk_identity_id" {
  type = string
}

variable "tenant_id" {
  type = string
}

variable "sku_name" {
  type    = string
  default = "GP_Standard_D4ds_v5"
}

variable "storage_mb" {
  type    = number
  default = 131072
}

variable "high_availability" {
  description = "Zone-redundant standby (required in prod)"
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  type    = number
  default = 35
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
