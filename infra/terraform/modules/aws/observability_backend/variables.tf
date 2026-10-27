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
  type = string
}

variable "log_retention_days" {
  description = "Object Lock retention of logs and traces (Loki and Tempo on S3, 180 days in IPB-01 §01.4.12)"
  type        = number
  default     = 180
}

variable "collector_endpoint" {
  description = "The in-cluster OTel Collector the apps send to"
  type        = string
  default     = "http://otel-collector.observability.svc:4318"
}
