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


variable "workload_pool" {
  description = "The cluster's Workload Identity pool (<project>.svc.id.goog)"
  type        = string
}

variable "namespace" {
  type    = string
  default = "apps"
}

variable "secrets_path_prefix" {
  description = "The workloads read the secrets <prefix>-* only"
  type        = string
}

variable "workloads" {
  description = "Service account name => extra project roles it needs (least privilege per workload)"
  type        = map(list(string))
}
