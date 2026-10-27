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
