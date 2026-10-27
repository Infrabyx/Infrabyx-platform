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

variable "location_dr" {
  description = "DR region, which holds a geo-replica"
  type        = string
}

variable "key_id" {
  description = "The platform key (versionless id)"
  type        = string
}

variable "cmk_identity_id" {
  type = string
}

variable "cmk_identity_client_id" {
  type = string
}

variable "pull_principal_ids" {
  description = "Name => principal allowed to pull (the cluster's kubelet identity)"
  type        = map(string)
  default     = {}
}

variable "untagged_retention_days" {
  type    = number
  default = 30
}
