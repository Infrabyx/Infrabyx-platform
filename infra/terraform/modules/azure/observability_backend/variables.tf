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
  description = "Subnets admitted by the account firewall (the node subnet)"
  type        = list(string)
}

variable "admin_cidrs" {
  type    = list(string)
  default = []
}

variable "log_retention_days" {
  description = "Locked retention of logs and traces (Loki and Tempo on Blob, 180 days in IPB-01 §01.4.12)"
  type        = number
  default     = 180
}

variable "collector_endpoint" {
  description = "The in-cluster OTel Collector the apps send to"
  type        = string
  default     = "http://otel-collector.observability.svc:4318"
}

variable "immutability_locked" {
  description = "Lock the immutability policies (irreversible). Azure creates them unlocked, so this is set in the apply after the accounts exist (PL6-D-06)"
  type        = bool
  default     = false
}
