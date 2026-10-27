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

variable "cidr" {
  description = "Node subnet range"
  type        = string
  default     = "10.30.0.0/20"
}

variable "pods_cidr" {
  type    = string
  default = "10.40.0.0/14"
}

variable "services_cidr" {
  type    = string
  default = "10.44.0.0/20"
}
