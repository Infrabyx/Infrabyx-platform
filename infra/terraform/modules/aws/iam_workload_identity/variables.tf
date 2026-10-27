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

variable "oidc_provider_arn" {
  type = string
}

variable "oidc_issuer" {
  description = "The cluster OIDC issuer URL"
  type        = string
}

variable "namespace" {
  type    = string
  default = "apps"
}

variable "workloads" {
  description = "Service account name => IAM policy ARNs it needs (least privilege per workload)"
  type        = map(list(string))
}
