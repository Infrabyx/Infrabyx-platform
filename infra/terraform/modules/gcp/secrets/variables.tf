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

variable "path_prefix" {
  description = "Secret id prefix, for example secrets-prod (Secret Manager ids allow no slash)"
  type        = string
  validation {
    condition     = can(regex("^secrets-[a-z-]+$", var.path_prefix))
    error_message = "path_prefix is secrets-<env>."
  }
}

variable "key_id" {
  type = string
}

variable "dr_key_id" {
  type = string
}
