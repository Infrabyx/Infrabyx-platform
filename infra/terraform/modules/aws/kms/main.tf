# The platform CMK: multi-region, rotated yearly, replicated to the DR region (IPB-01 §01.4.12).
resource "aws_kms_key" "platform" {
  description             = "${var.name} platform key"
  multi_region            = true
  enable_key_rotation     = true
  deletion_window_in_days = var.deletion_window_days
  tags                    = var.tags
}

resource "aws_kms_alias" "platform" {
  name          = "alias/${var.name}-platform"
  target_key_id = aws_kms_key.platform.key_id
}

resource "aws_kms_replica_key" "dr" {
  provider                = aws.dr
  description             = "${var.name} platform key (DR replica)"
  primary_key_arn         = aws_kms_key.platform.arn
  deletion_window_in_days = var.deletion_window_days
  tags                    = var.tags
}

# PR-LDC-60 (R1-D-158): one key per storage compartment location, the same kind as the platform
# key (multi-region, rotated yearly, replicated to the DR region) and never shared with it or
# with another compartment. Off by default (no compartments, no keys).
locals {
  cmp_abbrev = { REGULATED = "reg", CONFIDENTIAL = "conf", BOARD_CONFIDENTIAL = "board", SEALED = "sealed" }
  cmp_slots  = { for s in var.compartments : s => join("-", [for p in split(".", s) : local.cmp_abbrev[p]]) }
}

resource "aws_kms_key" "compartment" {
  for_each                = local.cmp_slots
  description             = "${var.name} ${each.key} compartment key"
  multi_region            = true
  enable_key_rotation     = true
  deletion_window_in_days = var.deletion_window_days
  tags                    = merge(var.tags, { compartment = each.key })
}

resource "aws_kms_alias" "compartment" {
  for_each      = local.cmp_slots
  name          = "alias/${var.name}-${each.value}"
  target_key_id = aws_kms_key.compartment[each.key].key_id
}

resource "aws_kms_replica_key" "compartment_dr" {
  for_each                = local.cmp_slots
  provider                = aws.dr
  description             = "${var.name} ${each.key} compartment key (DR replica)"
  primary_key_arn         = aws_kms_key.compartment[each.key].arn
  deletion_window_in_days = var.deletion_window_days
  tags                    = merge(var.tags, { compartment = each.key })
}
