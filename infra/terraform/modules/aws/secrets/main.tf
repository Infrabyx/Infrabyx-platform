# Read access to this environment's secrets only, for the workload roles to attach (IPB-02-28).
resource "aws_iam_policy" "read" {
  name        = "${var.name}-secrets-read"
  description = "Read ${var.path_prefix}/* through the Secrets Store CSI driver"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
        Resource = "arn:aws:secretsmanager:*:*:secret:${var.path_prefix}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = var.kms_key_arn
      }
    ]
  })
  tags = var.tags
}
