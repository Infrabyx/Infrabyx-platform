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
  description = "DR region (asia-south2 unless an ADR says otherwise)"
  type        = string
}

variable "multi_region" {
  description = "Multi-region of the dual-region buckets (asia for asia-south1 and asia-south2)"
  type        = string
  default     = "asia"
}

variable "compartments" {
  description = "PR-LDC-60 (R1-D-158): the storage compartment locations, as \"<CLASS>.<COMPARTMENT>\", each getting its own key. Off by default."
  type        = set(string)
  default     = []
  validation {
    condition     = alltrue([for s in var.compartments : can(regex("^(REGULATED|CONFIDENTIAL)\\.(BOARD_CONFIDENTIAL|SEALED)$", s))])
    error_message = "a compartment location is REGULATED or CONFIDENTIAL, then BOARD_CONFIDENTIAL or SEALED, such as CONFIDENTIAL.SEALED."
  }
}
