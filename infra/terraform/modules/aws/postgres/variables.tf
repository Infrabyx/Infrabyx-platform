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

variable "db_name" {
  description = "Database name (the product code)"
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets"
  type        = list(string)
}

variable "vpc_id" {
  type = string
}

variable "allowed_cidrs" {
  description = "Networks allowed to reach PostgreSQL (the cluster's private subnets)"
  type        = list(string)
}

variable "kms_key_arn" {
  type = string
}

variable "instance_class" {
  type    = string
  default = "db.r7g.large"
}

variable "allocated_storage_gb" {
  type    = number
  default = 100
}

variable "multi_az" {
  description = "Multi-AZ (required in prod)"
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  type    = number
  default = 35
}

variable "secrets_path_prefix" {
  description = "Secrets Manager path prefix, for example secrets/prod"
  type        = string
}
