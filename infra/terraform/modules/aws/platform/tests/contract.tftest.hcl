# The output contract on AWS (@IPB-01-AT-14, IPB-01-34; PL6 plan §7.3): the platform applies
# against mock providers (no credentials, no resources) and returns every contract key with the
# declared type, the five bucket classes and the reference regions; other regions need an ADR
# (IPB-01-36).

mock_provider "aws" {
  mock_resource "aws_eks_cluster" {
    defaults = {
      identity = [{ oidc = [{ issuer = "https://oidc.eks.ap-south-1.amazonaws.com/id/EXAMPLE" }] }]
    }
  }
  # The mock provider fills computed attributes with random strings; the provider still validates
  # the ARNs one resource passes to another, so those resources get well-formed ones.
  mock_resource "aws_kms_key" {
    defaults = {
      arn    = "arn:aws:kms:ap-south-1:111122223333:key/mrk-00000000000000000000000000000000"
      key_id = "mrk-00000000000000000000000000000000"
    }
  }
  mock_resource "aws_kms_replica_key" {
    defaults = { arn = "arn:aws:kms:ap-south-1:111122223333:key/mrk-00000000000000000000000000000000" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/mock" }
  }
  mock_resource "aws_iam_policy" {
    defaults = { arn = "arn:aws:iam::111122223333:policy/mock" }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::111122223333:oidc-provider/oidc.eks.ap-south-1.amazonaws.com/id/EXAMPLE" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:ap-south-1:111122223333:log-group:mock" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::mock" }
  }
  # IDs the provider checks for their prefix.
  mock_resource "aws_vpc" {
    defaults = { id = "vpc-0123456789abcdef0" }
  }
  mock_resource "aws_subnet" {
    defaults = { id = "subnet-0123456789abcdef0" }
  }
  mock_resource "aws_security_group" {
    defaults = { id = "sg-0123456789abcdef0" }
  }
  mock_resource "aws_internet_gateway" {
    defaults = { id = "igw-0123456789abcdef0" }
  }
  mock_resource "aws_nat_gateway" {
    defaults = { id = "nat-0123456789abcdef0" }
  }
  mock_resource "aws_route_table" {
    defaults = { id = "rtb-0123456789abcdef0" }
  }
  mock_resource "aws_eip" {
    defaults = { id = "eipalloc-0123456789abcdef0" }
  }
  mock_resource "aws_launch_template" {
    defaults = { id = "lt-0123456789abcdef0" }
  }
}

mock_provider "aws" {
  alias = "dr"
  mock_resource "aws_kms_key" {
    defaults = {
      arn    = "arn:aws:kms:ap-south-2:111122223333:key/mrk-00000000000000000000000000000000"
      key_id = "mrk-00000000000000000000000000000000"
    }
  }
  mock_resource "aws_kms_replica_key" {
    defaults = { arn = "arn:aws:kms:ap-south-2:111122223333:key/mrk-00000000000000000000000000000000" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/mock" }
  }
  mock_resource "aws_iam_policy" {
    defaults = { arn = "arn:aws:iam::111122223333:policy/mock" }
  }
  mock_resource "aws_iam_openid_connect_provider" {
    defaults = { arn = "arn:aws:iam::111122223333:oidc-provider/oidc.eks.ap-south-2.amazonaws.com/id/EXAMPLE" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:ap-south-2:111122223333:log-group:mock" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::mock" }
  }
}

variables {
  product                   = "fbx"
  env                       = "prod"
  domain                    = "app.example.test"
  regulated_retention_years = 8
}

run "output_contract" {
  command = apply

  assert {
    condition     = output.kubeconfig_ref == "secrets/prod/k8s/kubeconfig"
    error_message = "kubeconfig_ref is the secrets path of the kubeconfig"
  }
  assert {
    condition     = alltrue([for k in ["host", "port", "db", "ssl_mode", "credentials_secret_path"] : can(tostring(output.postgres[k]))])
    error_message = "postgres has host, port, db, ssl_mode and credentials_secret_path as strings"
  }
  assert {
    condition     = output.postgres.ssl_mode == "verify-full" && output.postgres.db == "fbx" && output.postgres.credentials_secret_path == "secrets/prod/db/app_rw"
    error_message = "postgres uses verify-full, the product database and the app_rw secret path"
  }
  assert {
    condition     = output.redis.url_secret_path == "secrets/prod/redis/url"
    error_message = "redis.url_secret_path is a secrets path"
  }
  assert {
    condition     = toset(keys(output.storage.buckets)) == toset(["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"])
    error_message = "storage.buckets maps every bucket class"
  }
  assert {
    condition     = alltrue([for v in values(output.storage.buckets) : can(regex("^infrabyx-fbx-prod-", v))]) && output.storage.lock_mode == "compliance"
    error_message = "bucket names carry the name prefix and the lock mode is compliance"
  }
  assert {
    condition     = can(tostring(output.kms.platform_key_id)) && output.kms.platform_key_id != ""
    error_message = "kms.platform_key_id is a string"
  }
  assert {
    condition     = output.secrets.provider == "aws-secrets-manager" && output.secrets.path_prefix == "secrets/prod"
    error_message = "secrets names the provider and the path prefix"
  }
  assert {
    condition     = can(tostring(output.edge.zone_id)) && output.edge.origin_hostname == "origin.app.example.test"
    error_message = "edge has the zone id and the origin hostname"
  }
  assert {
    condition     = can(regex("^https?://", output.observability.otlp_endpoint))
    error_message = "observability.otlp_endpoint is a URL"
  }
  assert {
    condition     = can(tostring(output.registry.url)) && output.registry.url != ""
    error_message = "registry.url is a string"
  }
  assert {
    condition     = output.region.primary == "ap-south-1" && output.region.dr == "ap-south-2"
    error_message = "the reference regions are ap-south-1 and ap-south-2"
  }
}

run "other_regions_need_an_adr" {
  command = plan
  variables {
    region_primary = "us-east-1"
    region_dr      = "us-west-2"
    azs            = ["us-east-1a", "us-east-1b", "us-east-1c"]
  }
  expect_failures = [terraform_data.region_check]
}

run "other_regions_with_an_adr" {
  command = plan
  variables {
    region_primary = "eu-west-1"
    region_dr      = "eu-central-1"
    region_adr     = "ADR-0009"
    azs            = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]
  }
}

run "unknown_product_refused" {
  command = plan
  variables {
    product = "acme"
  }
  expect_failures = [var.product]
}

# Storage compartments (PR-LDC-60, R1-D-158): off by default; when on, each location has its own
# bucket with its class's controls and its own key, never the platform key or another's.
run "compartments_off_by_default" {
  command = apply

  assert {
    condition     = length(output.storage.compartments) == 0 && length(module.kms.compartment_key_arns) == 0 && length(module.kms.compartment_dr_key_arns) == 0
    error_message = "no compartment bucket or key unless storage_compartments asks for one"
  }
  assert {
    condition     = toset(keys(output.storage.buckets)) == toset(["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"])
    error_message = "storage.buckets still maps exactly the five classes"
  }
}

run "compartments_on" {
  command = apply
  variables {
    storage_compartments = [
      { class = "CONFIDENTIAL", compartment = "BOARD_CONFIDENTIAL" },
      { class = "CONFIDENTIAL", compartment = "SEALED" },
      { class = "REGULATED", compartment = "BOARD_CONFIDENTIAL" },
      { class = "REGULATED", compartment = "SEALED" },
    ]
  }
  # The mock gives every key one ARN; real keys are distinct resources, so each gets its own here.
  override_resource {
    target = module.kms.aws_kms_key.compartment["CONFIDENTIAL.BOARD_CONFIDENTIAL"]
    values = { arn = "arn:aws:kms:ap-south-1:111122223333:key/mrk-11111111111111111111111111111111", key_id = "mrk-11111111111111111111111111111111" }
  }
  override_resource {
    target = module.kms.aws_kms_replica_key.compartment_dr["CONFIDENTIAL.BOARD_CONFIDENTIAL"]
    values = { arn = "arn:aws:kms:ap-south-2:111122223333:key/mrk-11111111111111111111111111111111" }
  }
  override_resource {
    target = module.kms.aws_kms_key.compartment["CONFIDENTIAL.SEALED"]
    values = { arn = "arn:aws:kms:ap-south-1:111122223333:key/mrk-22222222222222222222222222222222", key_id = "mrk-22222222222222222222222222222222" }
  }
  override_resource {
    target = module.kms.aws_kms_replica_key.compartment_dr["CONFIDENTIAL.SEALED"]
    values = { arn = "arn:aws:kms:ap-south-2:111122223333:key/mrk-22222222222222222222222222222222" }
  }
  override_resource {
    target = module.kms.aws_kms_key.compartment["REGULATED.BOARD_CONFIDENTIAL"]
    values = { arn = "arn:aws:kms:ap-south-1:111122223333:key/mrk-33333333333333333333333333333333", key_id = "mrk-33333333333333333333333333333333" }
  }
  override_resource {
    target = module.kms.aws_kms_replica_key.compartment_dr["REGULATED.BOARD_CONFIDENTIAL"]
    values = { arn = "arn:aws:kms:ap-south-2:111122223333:key/mrk-33333333333333333333333333333333" }
  }
  override_resource {
    target = module.kms.aws_kms_key.compartment["REGULATED.SEALED"]
    values = { arn = "arn:aws:kms:ap-south-1:111122223333:key/mrk-44444444444444444444444444444444", key_id = "mrk-44444444444444444444444444444444" }
  }
  override_resource {
    target = module.kms.aws_kms_replica_key.compartment_dr["REGULATED.SEALED"]
    values = { arn = "arn:aws:kms:ap-south-2:111122223333:key/mrk-44444444444444444444444444444444" }
  }

  assert {
    condition     = toset(keys(output.storage.compartments)) == toset(["CONFIDENTIAL.BOARD_CONFIDENTIAL", "CONFIDENTIAL.SEALED", "REGULATED.BOARD_CONFIDENTIAL", "REGULATED.SEALED"])
    error_message = "storage.compartments maps every location asked for"
  }
  assert {
    condition = (
      output.storage.compartments["CONFIDENTIAL.BOARD_CONFIDENTIAL"].bucket == "infrabyx-fbx-prod-conf-board" &&
      output.storage.compartments["CONFIDENTIAL.SEALED"].bucket == "infrabyx-fbx-prod-conf-sealed" &&
      output.storage.compartments["REGULATED.BOARD_CONFIDENTIAL"].bucket == "infrabyx-fbx-prod-reg-board" &&
      output.storage.compartments["REGULATED.SEALED"].bucket == "infrabyx-fbx-prod-reg-sealed"
    )
    error_message = "each location has its own bucket, named <name>-<class>-<compartment>"
  }
  assert {
    condition     = length(setintersection(toset([for c in values(output.storage.compartments) : c.bucket]), toset(values(output.storage.buckets)))) == 0
    error_message = "no compartment bucket is a class bucket"
  }
  assert {
    condition = (
      length(distinct([for c in values(output.storage.compartments) : c.key_id])) == 4 &&
      !contains([for c in values(output.storage.compartments) : c.key_id], output.kms.platform_key_id)
    )
    error_message = "every location has its own key, never the platform key"
  }
  assert {
    condition = (
      length(distinct(values(module.kms.compartment_dr_key_arns))) == 4 &&
      !contains(values(module.kms.compartment_dr_key_arns), module.kms.dr_key_arn)
    )
    error_message = "every location's key has its own DR replica, never the platform key's"
  }
  assert {
    condition = module.kms.compartment_aliases == {
      "CONFIDENTIAL.BOARD_CONFIDENTIAL" = "alias/infrabyx-fbx-prod-conf-board"
      "CONFIDENTIAL.SEALED"             = "alias/infrabyx-fbx-prod-conf-sealed"
      "REGULATED.BOARD_CONFIDENTIAL"    = "alias/infrabyx-fbx-prod-reg-board"
      "REGULATED.SEALED"                = "alias/infrabyx-fbx-prod-reg-sealed"
    }
    error_message = "each compartment key has its own alias"
  }
}

run "compartment_in_general_refused" {
  command = plan
  variables {
    storage_compartments = [{ class = "GENERAL", compartment = "SEALED" }]
  }
  expect_failures = [var.storage_compartments]
}

run "unknown_compartment_refused" {
  command = plan
  variables {
    storage_compartments = [{ class = "CONFIDENTIAL", compartment = "PRIVATE" }]
  }
  expect_failures = [var.storage_compartments]
}

run "compartment_given_twice_refused" {
  command = plan
  variables {
    storage_compartments = [
      { class = "REGULATED", compartment = "SEALED" },
      { class = "REGULATED", compartment = "SEALED" },
    ]
  }
  expect_failures = [var.storage_compartments]
}

# The compartment buckets' controls, on the object_storage module itself (its resources are not
# visible from the platform's runs).
run "object_storage_compartment_controls" {
  command = apply
  module {
    source = "../object_storage"
  }
  providers = {
    aws    = aws
    aws.dr = aws.dr
  }
  variables {
    name            = "infrabyx-ldc-prod"
    kms_key_arn     = "arn:aws:kms:ap-south-1:111122223333:key/mrk-00000000000000000000000000000000"
    dr_kms_key_arn  = "arn:aws:kms:ap-south-2:111122223333:key/mrk-00000000000000000000000000000000"
    retention_years = { REGULATED = 10 }
    storage_compartments = [
      { class = "CONFIDENTIAL", compartment = "BOARD_CONFIDENTIAL" },
      { class = "REGULATED", compartment = "SEALED" },
    ]
    compartment_kms_key_arns = {
      "CONFIDENTIAL.BOARD_CONFIDENTIAL" = "arn:aws:kms:ap-south-1:111122223333:key/mrk-11111111111111111111111111111111"
      "REGULATED.SEALED"                = "arn:aws:kms:ap-south-1:111122223333:key/mrk-22222222222222222222222222222222"
    }
    compartment_dr_kms_key_arns = {
      "CONFIDENTIAL.BOARD_CONFIDENTIAL" = "arn:aws:kms:ap-south-2:111122223333:key/mrk-11111111111111111111111111111111"
      "REGULATED.SEALED"                = "arn:aws:kms:ap-south-2:111122223333:key/mrk-22222222222222222222222222222222"
    }
  }

  assert {
    condition     = output.compartments["CONFIDENTIAL.BOARD_CONFIDENTIAL"].bucket == "infrabyx-ldc-prod-conf-board" && output.compartments["REGULATED.SEALED"].bucket == "infrabyx-ldc-prod-reg-sealed"
    error_message = "compartment buckets are named <name>-<class>-<compartment>"
  }
  assert {
    condition = alltrue([for s, c in output.compartments : c.key_id == var.compartment_kms_key_arns[s] && alltrue([
      for r in aws_s3_bucket_server_side_encryption_configuration.this[s].rule :
      r.apply_server_side_encryption_by_default[0].sse_algorithm == "aws:kms" && r.apply_server_side_encryption_by_default[0].kms_master_key_id == var.compartment_kms_key_arns[s] && r.bucket_key_enabled
    ])])
    error_message = "each compartment bucket is encrypted by default with its own key, which compartments returns"
  }
  assert {
    condition = alltrue([for c in ["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"] : alltrue([
      for r in aws_s3_bucket_server_side_encryption_configuration.this[c].rule : r.apply_server_side_encryption_by_default[0].kms_master_key_id == var.kms_key_arn
    ])])
    error_message = "the class buckets keep the platform key"
  }
  assert {
    condition = (
      aws_s3_bucket.this["CONFIDENTIAL.BOARD_CONFIDENTIAL"].object_lock_enabled && aws_s3_bucket.this["REGULATED.SEALED"].object_lock_enabled &&
      aws_s3_bucket_object_lock_configuration.this["CONFIDENTIAL.BOARD_CONFIDENTIAL"].rule[0].default_retention[0].mode == "COMPLIANCE" &&
      aws_s3_bucket_object_lock_configuration.this["CONFIDENTIAL.BOARD_CONFIDENTIAL"].rule[0].default_retention[0].years == 1 &&
      aws_s3_bucket_object_lock_configuration.this["REGULATED.SEALED"].rule[0].default_retention[0].mode == "COMPLIANCE" &&
      aws_s3_bucket_object_lock_configuration.this["REGULATED.SEALED"].rule[0].default_retention[0].years == 10
    )
    error_message = "each compartment bucket has Object Lock in compliance mode with its class's retention"
  }
  assert {
    condition = alltrue([for s in keys(output.compartments) :
      aws_s3_bucket_public_access_block.this[s].block_public_acls && aws_s3_bucket_public_access_block.this[s].block_public_policy &&
      aws_s3_bucket_public_access_block.this[s].ignore_public_acls && aws_s3_bucket_public_access_block.this[s].restrict_public_buckets &&
      aws_s3_bucket_ownership_controls.this[s].rule[0].object_ownership == "BucketOwnerEnforced" &&
      aws_s3_bucket_versioning.this[s].versioning_configuration[0].status == "Enabled" &&
      jsondecode(aws_s3_bucket_policy.tls[s].policy).Statement[0].Effect == "Deny" &&
      jsondecode(aws_s3_bucket_policy.tls[s].policy).Statement[0].Condition.Bool["aws:SecureTransport"] == "false"
    ])
    error_message = "each compartment bucket is private, owner-enforced, versioned and TLS-only"
  }
  assert {
    condition = alltrue([for s, c in output.compartments :
      aws_s3_bucket.dr[s].bucket == "${c.bucket}-dr" && aws_s3_bucket.dr[s].object_lock_enabled &&
      aws_s3_bucket_object_lock_configuration.dr[s].rule[0].default_retention[0].years == aws_s3_bucket_object_lock_configuration.this[s].rule[0].default_retention[0].years &&
      aws_s3_bucket_public_access_block.dr[s].restrict_public_buckets &&
      alltrue([for r in aws_s3_bucket_server_side_encryption_configuration.dr[s].rule : r.apply_server_side_encryption_by_default[0].kms_master_key_id == var.compartment_dr_kms_key_arns[s]]) &&
      aws_s3_bucket_replication_configuration.this[s].rule[0].destination[0].encryption_configuration[0].replica_kms_key_id == var.compartment_dr_kms_key_arns[s]
    ])
    error_message = "each compartment bucket replicates with its lock to a private DR bucket under its own key's DR replica"
  }
  assert {
    condition = alltrue([for s in keys(output.compartments) :
      contains(flatten([for st in jsondecode(aws_iam_role_policy.replication.policy).Statement : st.Resource if st.Action == ["kms:Decrypt"]]), var.compartment_kms_key_arns[s]) &&
      contains(flatten([for st in jsondecode(aws_iam_role_policy.replication.policy).Statement : st.Resource if contains(st.Action, "kms:Encrypt")]), var.compartment_dr_kms_key_arns[s])
    ])
    error_message = "the replication role decrypts with each compartment key and encrypts with its DR replica"
  }
  assert {
    condition     = toset(keys(output.buckets)) == toset(["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"])
    error_message = "buckets still maps the five classes only"
  }
}

run "object_storage_compartment_on_the_platform_key_refused" {
  command = plan
  module {
    source = "../object_storage"
  }
  providers = {
    aws    = aws
    aws.dr = aws.dr
  }
  variables {
    name                        = "infrabyx-ldc-prod"
    kms_key_arn                 = "arn:aws:kms:ap-south-1:111122223333:key/mrk-00000000000000000000000000000000"
    dr_kms_key_arn              = "arn:aws:kms:ap-south-2:111122223333:key/mrk-00000000000000000000000000000000"
    retention_years             = { REGULATED = 10 }
    storage_compartments        = [{ class = "CONFIDENTIAL", compartment = "SEALED" }]
    compartment_kms_key_arns    = { "CONFIDENTIAL.SEALED" = "arn:aws:kms:ap-south-1:111122223333:key/mrk-00000000000000000000000000000000" }
    compartment_dr_kms_key_arns = { "CONFIDENTIAL.SEALED" = "arn:aws:kms:ap-south-2:111122223333:key/mrk-11111111111111111111111111111111" }
  }
  expect_failures = [terraform_data.compartment_keys]
}

run "object_storage_compartment_without_a_key_refused" {
  command = plan
  module {
    source = "../object_storage"
  }
  providers = {
    aws    = aws
    aws.dr = aws.dr
  }
  variables {
    name                 = "infrabyx-ldc-prod"
    kms_key_arn          = "arn:aws:kms:ap-south-1:111122223333:key/mrk-00000000000000000000000000000000"
    dr_kms_key_arn       = "arn:aws:kms:ap-south-2:111122223333:key/mrk-00000000000000000000000000000000"
    retention_years      = { REGULATED = 10 }
    storage_compartments = [{ class = "REGULATED", compartment = "BOARD_CONFIDENTIAL" }]
  }
  expect_failures = [var.compartment_kms_key_arns, var.compartment_dr_kms_key_arns]
}

# The compartment keys, on the kms module itself: the platform key's kind, each with its own
# alias and DR replica.
run "kms_compartment_keys" {
  command = apply
  module {
    source = "../kms"
  }
  providers = {
    aws    = aws
    aws.dr = aws.dr
  }
  variables {
    name         = "infrabyx-ldc-prod"
    compartments = ["CONFIDENTIAL.BOARD_CONFIDENTIAL", "REGULATED.SEALED"]
  }

  assert {
    condition = alltrue([for s, k in aws_kms_key.compartment :
      k.multi_region && k.enable_key_rotation && k.deletion_window_in_days == 30 && k.tags["compartment"] == s &&
      aws_kms_replica_key.compartment_dr[s].primary_key_arn == k.arn
    ]) && length(aws_kms_key.compartment) == 2
    error_message = "each compartment key is multi-region and rotated like the platform key, with a DR replica of its own"
  }
  assert {
    condition     = aws_kms_alias.compartment["CONFIDENTIAL.BOARD_CONFIDENTIAL"].name == "alias/infrabyx-ldc-prod-conf-board" && aws_kms_alias.compartment["REGULATED.SEALED"].name == "alias/infrabyx-ldc-prod-reg-sealed"
    error_message = "each compartment key has its own alias"
  }
}

run "kms_unknown_compartment_refused" {
  command = plan
  module {
    source = "../kms"
  }
  providers = {
    aws    = aws
    aws.dr = aws.dr
  }
  variables {
    name         = "infrabyx-ldc-prod"
    compartments = ["GENERAL.SEALED"]
  }
  expect_failures = [var.compartments]
}
