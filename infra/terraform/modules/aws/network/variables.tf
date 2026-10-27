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

variable "cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "azs" {
  description = "Availability zones (three in prod)"
  type        = list(string)
}

variable "flow_log_retention_days" {
  description = "CloudWatch retention of VPC flow logs"
  type        = number
  default     = 180
}

variable "kms_key_arn" {
  description = "KMS key for the flow-log group"
  type        = string
}
