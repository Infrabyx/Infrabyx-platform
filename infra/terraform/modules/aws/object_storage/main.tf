locals {
  classes = ["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"]
  # Only GENERAL and PUBLIC_ASSETS may run without lock (IPB-01 §01.4.7).
  locked_classes = { for c in ["AUDIT", "REGULATED", "CONFIDENTIAL"] : c => var.retention_years[c] }
  class_names    = { for c in local.classes : c => "${var.name}-${replace(lower(c), "_", "-")}" }

  # PR-LDC-60 (R1-D-158): a compartment location "<CLASS>.<COMPARTMENT>" gets a bucket of its own
  # with every control of its class (lock and retention, DR copy, private, versioned, TLS only)
  # under its own key in place of the platform key. Off by default.
  cmp_abbrev = { REGULATED = "reg", CONFIDENTIAL = "conf", BOARD_CONFIDENTIAL = "board", SEALED = "sealed" }
  cmp        = { for p in var.storage_compartments : "${p.class}.${p.compartment}" => p }
  cmp_names  = { for s, p in local.cmp : s => "${var.name}-${local.cmp_abbrev[p.class]}-${local.cmp_abbrev[p.compartment]}" }

  # Every bucket, keyed by its location: the five classes, then the compartments. The class keys
  # are unchanged, so adding compartments never moves an existing bucket.
  names     = merge(local.class_names, local.cmp_names)
  slot_tags = { for s in keys(local.names) : s => merge({ bucket_class = split(".", s)[0] }, length(split(".", s)) > 1 ? { compartment = split(".", s)[1] } : {}) }
  locked    = merge(local.locked_classes, { for s, p in local.cmp : s => var.retention_years[p.class] })
  key_of    = merge({ for c in local.classes : c => var.kms_key_arn }, { for s in keys(local.cmp) : s => lookup(var.compartment_kms_key_arns, s, "") })
  dr_key_of = merge(
    { for c in keys(local.locked_classes) : c => var.dr_kms_key_arn },
    { for s in keys(local.cmp) : s => lookup(var.compartment_dr_kms_key_arns, s, "") },
  )
}

# A compartment's keys exist and are its own: never the platform key, never another
# compartment's (the STORAGE adapter refuses the same at start-up).
resource "terraform_data" "compartment_keys" {
  for_each = local.cmp
  input    = each.key
  lifecycle {
    precondition {
      condition = (
        length(distinct(values(local.key_of))) == length(local.key_of) - length(local.classes) + 1 &&
        length(distinct(values(local.dr_key_of))) == length(local.dr_key_of) - length(local.locked_classes) + 1
      )
      error_message = "PR-LDC-60: every compartment location has its own primary and DR key, distinct from the platform key and from every other compartment's."
    }
  }
}

resource "aws_s3_bucket" "this" {
  for_each            = local.names
  bucket              = each.value
  object_lock_enabled = contains(keys(local.locked), each.key)
  tags                = merge(var.tags, local.slot_tags[each.key])
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = local.names
  bucket                  = aws_s3_bucket.this[each.key].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = local.names
  bucket   = aws_s3_bucket.this[each.key].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = local.names
  bucket   = aws_s3_bucket.this[each.key].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = local.names
  bucket   = aws_s3_bucket.this[each.key].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = local.key_of[each.key]
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_object_lock_configuration" "this" {
  for_each = local.locked
  bucket   = aws_s3_bucket.this[each.key].id
  rule {
    default_retention {
      mode  = "COMPLIANCE"
      years = each.value
    }
  }
}

# TLS only, on every bucket.
resource "aws_s3_bucket_policy" "tls" {
  for_each = local.names
  bucket   = aws_s3_bucket.this[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.this[each.key].arn, "${aws_s3_bucket.this[each.key].arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.this]
}

# DR copies of the locked classes and the compartments, with the same lock, in the DR region (IPB-01 §01.4.7).
resource "aws_s3_bucket" "dr" {
  for_each            = local.locked
  provider            = aws.dr
  bucket              = "${local.names[each.key]}-dr"
  object_lock_enabled = true
  tags                = merge(var.tags, local.slot_tags[each.key], { role = "dr" })
}

resource "aws_s3_bucket_public_access_block" "dr" {
  for_each                = local.locked
  provider                = aws.dr
  bucket                  = aws_s3_bucket.dr[each.key].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "dr" {
  for_each = local.locked
  provider = aws.dr
  bucket   = aws_s3_bucket.dr[each.key].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "dr" {
  for_each = local.locked
  provider = aws.dr
  bucket   = aws_s3_bucket.dr[each.key].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = local.dr_key_of[each.key]
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_object_lock_configuration" "dr" {
  for_each = local.locked
  provider = aws.dr
  bucket   = aws_s3_bucket.dr[each.key].id
  rule {
    default_retention {
      mode  = "COMPLIANCE"
      years = each.value
    }
  }
}

resource "aws_iam_role" "replication" {
  name = "${var.name}-s3-replication"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "s3.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "replication" {
  name = "replicate-locked-classes"
  role = aws_iam_role.replication.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
        Resource = [for c in keys(local.locked) : aws_s3_bucket.this[c].arn]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObjectVersionForReplication", "s3:GetObjectVersionAcl", "s3:GetObjectRetention", "s3:GetObjectLegalHold"]
        Resource = [for c in keys(local.locked) : "${aws_s3_bucket.this[c].arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ReplicateObject", "s3:ReplicateDelete", "s3:ObjectOwnerOverrideToBucketOwner"]
        Resource = [for c in keys(local.locked) : "${aws_s3_bucket.dr[c].arn}/*"]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = distinct([for s in keys(local.locked) : local.key_of[s]])
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Encrypt", "kms:GenerateDataKey"]
        Resource = distinct(values(local.dr_key_of))
      }
    ]
  })
}

resource "aws_s3_bucket_replication_configuration" "this" {
  for_each = local.locked
  bucket   = aws_s3_bucket.this[each.key].id
  role     = aws_iam_role.replication.arn
  rule {
    id     = "to-dr"
    status = "Enabled"
    filter {}
    delete_marker_replication {
      status = "Disabled"
    }
    source_selection_criteria {
      sse_kms_encrypted_objects {
        status = "Enabled"
      }
    }
    destination {
      bucket = aws_s3_bucket.dr[each.key].arn
      encryption_configuration {
        replica_kms_key_id = local.dr_key_of[each.key]
      }
    }
  }
  depends_on = [aws_s3_bucket_versioning.this, aws_s3_bucket_versioning.dr]
}
