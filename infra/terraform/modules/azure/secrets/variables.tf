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

variable "path_prefix" {
  description = "Secret name prefix, for example secrets-prod (Key Vault names allow no slash)"
  type        = string
  validation {
    condition     = can(regex("^secrets-[a-z-]+$", var.path_prefix))
    error_message = "path_prefix is secrets-<env>."
  }
}

variable "allowed_subnet_ids" {
  description = "Subnets admitted by the vault firewall (the node subnet)"
  type        = list(string)
}

variable "admin_cidrs" {
  description = "Networks of the bootstrap that writes the values"
  type        = list(string)
  default     = []
}
