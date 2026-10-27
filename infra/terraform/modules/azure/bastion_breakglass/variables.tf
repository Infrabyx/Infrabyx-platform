variable "name" {
  description = "Resource name prefix: infrabyx-<product>-<env>"
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,40}$", var.name))
    error_message = "name is lower-case letters, digits and hyphens, 3 to 41 characters."
  }
}

variable "enabled" {
  description = "Turn on only for an incident, and off again after it"
  type        = bool
  default     = false
}

variable "cluster_id" {
  description = "The AKS cluster the break-glass group administers"
  type        = string
}

variable "principal_ids" {
  description = "Name => Entra group allowed in (the incident responders; MFA is enforced by Conditional Access)"
  type        = map(string)
  default     = {}
}
