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

variable "subnet_id" {
  description = "The node subnet"
  type        = string
}

variable "tenant_id" {
  type = string
}

variable "kubernetes_version" {
  description = "AKS minor version (a currently supported one)"
  type        = string
  default     = "1.33"
}

variable "node_vm_size" {
  type    = string
  default = "Standard_D4ds_v5"
}

variable "admin_cidrs" {
  description = "Networks allowed to the API server; empty keeps the cluster private"
  type        = list(string)
  default     = []
}

variable "log_retention_days" {
  type    = number
  default = 90
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
