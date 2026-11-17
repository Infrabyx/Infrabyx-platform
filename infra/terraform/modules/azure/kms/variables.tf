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
  description = "DR region (southindia unless an ADR says otherwise)"
  type        = string
}

variable "allowed_subnet_ids" {
  description = "Subnets admitted by the vault firewall (the node subnet)"
  type        = list(string)
}

variable "admin_cidrs" {
  description = "Networks of the deployment runner, admitted to create and rotate keys"
  type        = list(string)
  default     = []
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
