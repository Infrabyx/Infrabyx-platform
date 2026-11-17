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

variable "storage_compartments" {
  description = "PR-LDC-60 (R1-D-158): compartment locations to create, each with its own bucket and key. Off by default."
  type = list(object({
    class       = string # REGULATED or CONFIDENTIAL
    compartment = string # BOARD_CONFIDENTIAL or SEALED
  }))
  default = []
  validation {
    condition     = alltrue([for p in var.storage_compartments : contains(["REGULATED", "CONFIDENTIAL"], p.class) && contains(["BOARD_CONFIDENTIAL", "SEALED"], p.compartment)])
    error_message = "a compartment is BOARD_CONFIDENTIAL or SEALED, in the class REGULATED or CONFIDENTIAL."
  }
  validation {
    condition     = length(distinct([for p in var.storage_compartments : "${p.class}.${p.compartment}"])) == length(var.storage_compartments)
    error_message = "each compartment location (class and compartment) is given once."
  }
}

variable "compartment_key_ids" {
  description = "\"<CLASS>.<COMPARTMENT>\" => that location's own key in the multi-region ring (the kms module's compartment_key_ids)"
  type        = map(string)
  default     = {}
  validation {
    condition     = alltrue([for p in var.storage_compartments : contains(keys(var.compartment_key_ids), "${p.class}.${p.compartment}")])
    error_message = "PR-LDC-60: every compartment location in storage_compartments needs its own key here."
  }
}
