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

variable "kms_key_arn" {
  description = "Primary-region key"
  type        = string
}

variable "dr_kms_key_arn" {
  description = "DR-region replica key"
  type        = string
}

variable "retention_years" {
  description = "Default Object Lock (compliance) retention per locked class (IPB-01 §01.4.7). REGULATED has no default: the product's statutory rule decides it."
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

variable "compartment_kms_key_arns" {
  description = "\"<CLASS>.<COMPARTMENT>\" => that location's own primary-region key (the kms module's compartment_key_arns)"
  type        = map(string)
  default     = {}
  validation {
    condition     = alltrue([for p in var.storage_compartments : contains(keys(var.compartment_kms_key_arns), "${p.class}.${p.compartment}")])
    error_message = "PR-LDC-60: every compartment location in storage_compartments needs its own key here."
  }
}

variable "compartment_dr_kms_key_arns" {
  description = "\"<CLASS>.<COMPARTMENT>\" => the DR replica of that location's key"
  type        = map(string)
  default     = {}
  validation {
    condition     = alltrue([for p in var.storage_compartments : contains(keys(var.compartment_dr_kms_key_arns), "${p.class}.${p.compartment}")])
    error_message = "PR-LDC-60: every compartment location in storage_compartments needs its own key here."
  }
}
