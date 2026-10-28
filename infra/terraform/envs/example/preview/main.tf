# Example environment stack (IPB-01 §01.4.9.2; PL6 plan §7.1): a product composes the platform
# module for one environment and reads only its output contract. Validated in CI, never applied
# from this repository. Copy it to infra/terraform/envs/<product>/<env>/ in the product.
#
# After `tofu apply`, `tofu output -json > outputs.auto.json` feeds the environment's routing.yaml
# and Helm values. State is SECRET class (it can hold provider-generated secrets, such as the
# Memorystore AUTH string on GCP): keep it in the cloud's locked remote backend, encrypted on the
# client as below from the first apply (owner answers #71, #72; PL6-D-16; docs/product-guide.md §4).

terraform {
  required_version = ">= 1.10.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.69.1"
    }
  }
  # Client-side state encryption (OpenTofu): state and plans are written with AES-GCM only, never
  # in plain text. The key is derived from a passphrase supplied at run time
  # (TF_VAR_state_passphrase, at least 16 characters, from the CI secret store). Once the
  # environment's KMS key exists, replace the pbkdf2 provider with `aws_kms` (or `gcp_kms`,
  # `openbao`) and keep this method as a `fallback` for one apply.
  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.state_passphrase
    }
    method "aes_gcm" "state" {
      keys = key_provider.pbkdf2.state
    }
    state {
      method   = method.aes_gcm.state
      enforced = true
    }
    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
  # backend "s3" {
  #   bucket       = "<state bucket>"
  #   key          = "<product>/<env>/platform.tfstate"
  #   region       = "ap-south-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

variable "state_passphrase" {
  description = "Passphrase the state and plan encryption key is derived from; never committed"
  type        = string
  sensitive   = true
}

provider "aws" {
  region = "ap-south-1"
}

provider "aws" {
  alias  = "dr"
  region = "ap-south-2"
}

module "platform" {
  source                    = "../../../modules/aws/platform"
  providers                 = { aws = aws, aws.dr = aws.dr }
  product                   = "grp"
  env                       = "preview"
  domain                    = "preview.example.test"
  regulated_retention_years = 8
}

output "platform" {
  description = "The output contract (IPB-01 §01.4.9.3)"
  value = {
    kubeconfig_ref = module.platform.kubeconfig_ref
    postgres       = module.platform.postgres
    redis          = module.platform.redis
    storage        = module.platform.storage
    kms            = module.platform.kms
    secrets        = module.platform.secrets
    edge           = module.platform.edge
    observability  = module.platform.observability
    registry       = module.platform.registry
    region         = module.platform.region
  }
}
