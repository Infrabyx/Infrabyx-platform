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

variable "key_id" {
  description = "The platform key (versionless id)"
  type        = string
}

variable "cmk_identity_id" {
  type = string
}

variable "allowed_subnet_ids" {
  description = "Subnets admitted by the account firewalls (the node subnet)"
  type        = list(string)
}

variable "admin_cidrs" {
  description = "Networks of the deployment runner (plain addresses for /32)"
  type        = list(string)
  default     = []
}

variable "retention_years" {
  description = "Default immutability (locked) retention per locked class (IPB-01 §01.4.7). REGULATED has no default: the product's statutory rule decides it."
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

variable "immutability_locked" {
  description = "Lock the immutability policies (irreversible). Azure creates them unlocked, so this is set in the apply after the accounts exist (PL6-D-06)"
  type        = bool
  default     = false
}
