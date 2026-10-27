locals {
  classes = ["AUDIT", "REGULATED", "CONFIDENTIAL", "GENERAL", "PUBLIC_ASSETS"]
  # Only GENERAL and PUBLIC_ASSETS may run without lock (IPB-01 §01.4.7).
  locked = { for c in ["AUDIT", "REGULATED", "CONFIDENTIAL"] : c => var.retention_years[c] }
  names  = { for c in local.classes : c => "${var.name}-${replace(lower(c), "_", "-")}" }
}

resource "aws_s3_bucket" "this" {
  for_each            = local.names
  bucket              = each.value
  object_lock_enabled = contains(keys(local.locked), each.key)
  tags                = merge(var.tags, { bucket_class = each.key })
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
      kms_master_key_id = var.kms_key_arn
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

# DR copies of the locked classes, with the same lock, in the DR region (IPB-01 §01.4.7).
resource "aws_s3_bucket" "dr" {
  for_each            = local.locked
  provider            = aws.dr
  bucket              = "${local.names[each.key]}-dr"
  object_lock_enabled = true
  tags                = merge(var.tags, { bucket_class = each.key, role = "dr" })
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
      kms_master_key_id = var.dr_kms_key_arn
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
        Resource = [var.kms_key_arn]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Encrypt", "kms:GenerateDataKey"]
        Resource = [var.dr_kms_key_arn]
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
        replica_kms_key_id = var.dr_kms_key_arn
      }
    }
  }
  depends_on = [aws_s3_bucket_versioning.this, aws_s3_bucket_versioning.dr]
}
