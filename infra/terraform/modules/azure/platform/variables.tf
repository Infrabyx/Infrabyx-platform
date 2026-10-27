# Inputs of the Azure platform composition: the names of the AWS and GCP platform modules, so a
# product's environment stack swaps clouds by swapping the module source (IPB-01 §01.4.9).

variable "product" {
  description = "Product code, lower case (udf, fbx, ld, ldc, eq, oh)"
  type        = string
  validation {
    condition     = contains(["udf", "fbx", "ld", "ldc", "eq", "oh", "grp"], var.product)
    error_message = "product is one of udf, fbx, ld, ldc, eq, oh, grp."
  }
}

variable "env" {
  description = "Environment (IPB-09-15)"
  type        = string
  validation {
    condition     = contains(["dev", "test", "preview", "staging", "pre-prod", "demo", "prod", "dr"], var.env)
    error_message = "env is one of the IPB-09-15 environments that run in a cloud."
  }
}

variable "region_primary" {
  description = "Primary region; centralindia unless region_adr names an ADR (IPB-01-36)"
  type        = string
  default     = "centralindia"
}

variable "region_dr" {
  description = "DR region; southindia (the paired region) unless region_adr names an ADR (IPB-01-36)"
  type        = string
  default     = "southindia"
}

variable "region_adr" {
  description = "The ADR approving other regions (with the IPB-02 residency review); empty for the reference regions"
  type        = string
  default     = ""
  validation {
    condition     = var.region_adr == "" || can(regex("^ADR-[0-9]{4}$", var.region_adr))
    error_message = "region_adr is empty or an ADR id such as ADR-0007."
  }
}

variable "azs" {
  description = "Availability zones in the primary region (Azure numbers them)"
  type        = list(string)
  default     = ["1", "2", "3"]
}

variable "domain" {
  description = "The product's DNS zone"
  type        = string
}

variable "regulated_retention_years" {
  description = "Immutability retention of the REGULATED class: the product's statutory period (IPB-01 §01.4.7 [VERIFY])"
  type        = number
}

variable "workloads" {
  description = "Service account => extra Azure role names at the resource group (Key Vault Secrets User on the secrets vault is always assigned)"
  type        = map(list(string))
  default = {
    api     = []
    worker  = []
    web     = []
    public  = []
    console = []
  }
}

variable "admin_cidrs" {
  description = "Networks allowed to the Kubernetes API server and to the vault and account firewalls (the deployment runner); empty keeps them private"
  type        = list(string)
  default     = []
}

variable "immutability_locked" {
  description = "Lock the immutability policies (irreversible). Azure creates them unlocked, so this is set in the apply after the accounts exist (PL6-D-06)"
  type        = bool
  default     = false
}
