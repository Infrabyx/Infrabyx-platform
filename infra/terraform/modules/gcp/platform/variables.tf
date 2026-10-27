# Inputs of the GCP platform composition: the names of the AWS and Azure platform modules, so a
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
  description = "Primary region; asia-south1 unless region_adr names an ADR (IPB-01-36)"
  type        = string
  default     = "asia-south1"
}

variable "region_dr" {
  description = "DR region; asia-south2 unless region_adr names an ADR (IPB-01-36)"
  type        = string
  default     = "asia-south2"
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
  description = "Zones in the primary region"
  type        = list(string)
  default     = ["asia-south1-a", "asia-south1-b", "asia-south1-c"]
}

variable "domain" {
  description = "The product's DNS zone"
  type        = string
}

variable "regulated_retention_years" {
  description = "Locked retention of the REGULATED class: the product's statutory period (IPB-01 §01.4.7 [VERIFY])"
  type        = number
}

variable "workloads" {
  description = "Service account => extra project roles (Secret Manager accessor on this environment's secrets is always granted)"
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
  description = "Networks allowed to the Kubernetes control plane; empty keeps the endpoint private"
  type        = list(string)
  default     = []
}

variable "multi_region" {
  description = "Multi-region of the dual-region buckets and their key (asia for the reference regions)"
  type        = string
  default     = "asia"
}
