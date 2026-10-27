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

variable "zones" {
  description = "Zones the node pool spreads across"
  type        = list(string)
}

variable "network_id" {
  type = string
}

variable "subnet_id" {
  description = "The node subnet with the pods and services secondary ranges"
  type        = string
}

variable "key_id" {
  description = "The platform key (etcd secrets and node boot disks)"
  type        = string
}

variable "machine_type" {
  type    = string
  default = "e2-standard-4"
}

variable "master_cidr" {
  description = "Range of the private control plane"
  type        = string
  default     = "172.16.0.0/28"
}

variable "admin_cidrs" {
  description = "Networks allowed to the control plane; empty keeps the endpoint private"
  type        = list(string)
  default     = []
}

variable "secrets_path_prefix" {
  description = "Secret id prefix, for example secrets-prod"
  type        = string
}
