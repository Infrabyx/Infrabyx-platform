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

variable "path_prefix" {
  description = "Secrets Manager path prefix for this environment, for example secrets/prod"
  type        = string
  validation {
    condition     = can(regex("^secrets/[a-z-]+$", var.path_prefix))
    error_message = "path_prefix is secrets/<env>."
  }
}

variable "kms_key_arn" {
  type = string
}
