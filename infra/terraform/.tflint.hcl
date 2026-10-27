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
