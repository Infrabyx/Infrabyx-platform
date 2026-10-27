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

variable "kubernetes_version" {
  description = "EKS minor version (a currently supported one)"
  type        = string
  default     = "1.33"
}

variable "subnet_ids" {
  type = list(string)
}

variable "kms_key_arn" {
  type = string
}

variable "secrets_path_prefix" {
  type = string
}

variable "node_instance_types" {
  type    = list(string)
  default = ["m7g.large"]
}

variable "node_count" {
  type = object({ min = number, desired = number, max = number })
  default = {
    min     = 2
    desired = 3
    max     = 6
  }
}

variable "admin_cidrs" {
  description = "Networks allowed to reach the public API endpoint; empty keeps the endpoint private only"
  type        = list(string)
  default     = []
}
