resource "aws_elasticache_subnet_group" "this" {
  name       = var.name
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "this" {
  name        = "${var.name}-redis"
  description = "Redis from the cluster only"
  vpc_id      = var.vpc_id
  ingress {
    description = "Redis TLS"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidrs
  }
  tags = var.tags
}

# IAM authentication for the application user; no password exists (IPB-02-28).
resource "aws_elasticache_user" "app" {
  user_id       = "${var.name}-app"
  user_name     = "app"
  engine        = "redis"
  access_string = "on ~* +@all -@dangerous"
  authentication_mode {
    type = "iam"
  }
  tags = var.tags
}

resource "aws_elasticache_user" "default_off" {
  user_id       = "${var.name}-default"
  user_name     = "default"
  engine        = "redis"
  access_string = "off -@all"
  authentication_mode {
    type = "iam"
  }
  tags = var.tags
}

resource "aws_elasticache_user_group" "this" {
  user_group_id = var.name
  engine        = "redis"
  user_ids      = [aws_elasticache_user.default_off.user_id, aws_elasticache_user.app.user_id]
  tags          = var.tags
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = var.name
  description                = "${var.name} queue and cache"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.node_type
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [aws_security_group.this.id]
  at_rest_encryption_enabled = true
  kms_key_id                 = var.kms_key_arn
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"
  user_group_ids             = [aws_elasticache_user_group.this.user_group_id]
  snapshot_retention_limit   = 7
  tags                       = var.tags
}

resource "aws_secretsmanager_secret" "url" {
  name       = "${var.secrets_path_prefix}/redis/url"
  kms_key_id = var.kms_key_arn
  tags       = var.tags
}
