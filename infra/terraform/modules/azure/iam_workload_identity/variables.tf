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

variable "oidc_issuer" {
  description = "The cluster OIDC issuer URL"
  type        = string
}

variable "namespace" {
  type    = string
  default = "apps"
}

variable "secrets_vault_id" {
  description = "The environment's secrets vault, read through the Secrets Store CSI driver"
  type        = string
}

variable "role_scope" {
  description = "Scope of the extra role assignments (the environment's resource group)"
  type        = string
}

variable "workloads" {
  description = "Service account name => extra Azure role names it needs at role_scope (least privilege per workload)"
  type        = map(list(string))
}
