# tflint for every module and stack under infra/terraform (PL6 plan §7.3), run from this directory
# with --recursive by the `infra` job. The rulesets are built from pinned versions by
# scripts/ci/infra-tools.sh into TFLINT_PLUGIN_DIR; nothing is downloaded at lint time.
config {
  call_module_type = "local"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "aws" {
  enabled = true
}

plugin "azurerm" {
  enabled = true
}

plugin "google" {
  enabled = true
}

# A platform composition declares the providers its child modules use without a resource of
# its own for each.
rule "terraform_unused_required_providers" {
  enabled = false
}

# Deletion protection on Azure is the platform's own: CanNotDelete management locks on the
# storage accounts, key vaults and the PostgreSQL server (a lock covers their child resources),
# plus purge protection on the vaults. prevent_destroy cannot vary per environment and would stop
# `tofu test` from cleaning up its mock resources.
rule "azurerm_resources_missing_prevent_destroy" {
  enabled = false
}
