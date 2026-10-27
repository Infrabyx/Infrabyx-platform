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
  type = string
}

variable "multi_region" {
  description = "Multi-region holding the dual-region buckets (asia)"
  type        = string
  default     = "asia"
}

variable "key_id" {
  description = "The platform key in the primary region"
  type        = string
}

variable "multi_region_key_id" {
  description = "The platform key in the multi-region, for the dual-region buckets"
  type        = string
}

variable "retention_years" {
  description = "Default locked retention per locked class (IPB-01 §01.4.7). REGULATED has no default: the product's statutory rule decides it."
  type = object({
    AUDIT        = optional(number, 8)
    REGULATED    = number
    CONFIDENTIAL = optional(number, 1)
  })
  validation {
    condition     = var.retention_years.REGULATED >= 1
    error_message = "REGULATED retention is at least 1 year; set the product's statutory period."
  }
}
