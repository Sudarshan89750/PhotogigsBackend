// ═══════════════════════════════════════════════════════════════════════════════
//  PhotoGigs — MongoDB Collection Definitions  (Atlas M0 / any Mongo 6+)
// ═══════════════════════════════════════════════════════════════════════════════
//
//  Run once on a fresh database:
//    mongosh "$MONGODB_URI" collections_reference.js
//
//  This script pre-creates every collection with JSON-Schema validation and
//  all indexes used by the Mongoose models.
// ═══════════════════════════════════════════════════════════════════════════════

const dbName = "photogigs";
const db = db.getSiblingDB ? db.getSiblingDB(dbName) : use(dbName);

// ─── 1. Jobs ─────────────────────────────────────────────────────────────────

db.createCollection("jobs", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["clientId", "title", "description", "category", "budget", "city", "state", "country"],
      properties: {
        clientId:              { bsonType: "string", description: "PG users.id of the client" },
        freelancerId:          { bsonType: "string", description: "PG users.id of assigned freelancer" },
        title:                 { bsonType: "string" },
        description:           { bsonType: "string" },
        category:              { bsonType: "string", description: "e.g. Wedding, Events, Portrait" },
        budget:                { bsonType: "number", minimum: 0 },
        city:                  { bsonType: "string" },
        state:                 { bsonType: "string" },
        country:               { bsonType: "string" },
        latitude:              { bsonType: "number" },
        longitude:             { bsonType: "number" },
        location: {
          bsonType: "object",
          properties: {
            type:        { enum: ["Point"] },
            coordinates: { bsonType: "array", items: { bsonType: "number" } }
          }
        },
        eventDate:             { bsonType: "date" },
        duration:              { bsonType: "string", description: "e.g. '4 hours', '2 days'" },
        deliverables:          { bsonType: "string" },
        requirements:          { bsonType: "array", items: { bsonType: "string" } },
        images:                { bsonType: "array", items: { bsonType: "string" } },
        status: {
          bsonType: "string",
          enum: ["draft", "open", "in_progress", "submitted", "revision", "completed", "cancelled", "disputed"]
        },
        acceptedProposalId:    { bsonType: "string" },
        submissionFiles:       { bsonType: "array", items: { bsonType: "string" } },
        submissionDescription: { bsonType: "string" },
        revisionNotes:         { bsonType: "string" }
      }
    }
  }
});

db.jobs.createIndex({ clientId: 1 });
db.jobs.createIndex({ freelancerId: 1 });
db.jobs.createIndex({ category: 1 });
db.jobs.createIndex({ status: 1 });
db.jobs.createIndex({ location: "2dsphere" });
db.jobs.createIndex({ status: 1, category: 1 });

// ─── 2. Proposals ────────────────────────────────────────────────────────────

db.createCollection("proposals", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["jobId", "freelancerId", "coverLetter", "proposedPrice"],
      properties: {
        jobId:              { bsonType: "string" },
        freelancerId:       { bsonType: "string" },
        coverLetter:        { bsonType: "string" },
        proposedPrice:      { bsonType: "number", minimum: 0 },
        estimatedDuration:  { bsonType: "string" },
        portfolioLinks:     { bsonType: "array", items: { bsonType: "string" } },
        status: {
          bsonType: "string",
          enum: ["pending", "accepted", "rejected", "withdrawn"]
        }
      }
    }
  }
});

db.proposals.createIndex({ jobId: 1 });
db.proposals.createIndex({ freelancerId: 1 });
db.proposals.createIndex({ jobId: 1, freelancerId: 1 }, { unique: true });

// ─── 3. Listings (Marketplace) ───────────────────────────────────────────────

db.createCollection("listings", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["sellerId", "title", "description", "listingType", "category", "condition", "price", "city", "state", "country"],
      properties: {
        sellerId:           { bsonType: "string" },
        title:              { bsonType: "string" },
        description:        { bsonType: "string" },
        listingType:        { bsonType: "string", enum: ["sell", "rent"] },
        category:           { bsonType: "string" },
        condition:          { bsonType: "string" },
        brand:              { bsonType: "string" },
        modelName:          { bsonType: "string" },
        price:              { bsonType: "number", minimum: 0 },
        rentalPricePerDay:  { bsonType: "number" },
        depositAmount:      { bsonType: "number" },
        city:               { bsonType: "string" },
        state:              { bsonType: "string" },
        country:            { bsonType: "string" },
        latitude:           { bsonType: "number" },
        longitude:          { bsonType: "number" },
        location: {
          bsonType: "object",
          properties: {
            type:        { enum: ["Point"] },
            coordinates: { bsonType: "array", items: { bsonType: "number" } }
          }
        },
        images:             { bsonType: "array", items: { bsonType: "string" } },
        status: {
          bsonType: "string",
          enum: ["active", "sold", "rented", "inactive"]
        }
      }
    }
  }
});

db.listings.createIndex({ sellerId: 1 });
db.listings.createIndex({ category: 1 });
db.listings.createIndex({ status: 1 });
db.listings.createIndex({ location: "2dsphere" });
db.listings.createIndex({ status: 1, listingType: 1, category: 1 });

// ─── 4. Marketplace Orders ──────────────────────────────────────────────────

db.createCollection("marketplaceorders", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["listingId", "buyerId", "sellerId", "orderType", "amount"],
      properties: {
        listingId:            { bsonType: "string" },
        buyerId:              { bsonType: "string" },
        sellerId:             { bsonType: "string" },
        orderType:            { bsonType: "string", enum: ["sell", "rent"] },
        amount:               { bsonType: "number", minimum: 0 },
        depositAmount:        { bsonType: "number" },
        rentalStartDate:      { bsonType: "date" },
        rentalEndDate:        { bsonType: "date" },
        status: {
          bsonType: "string",
          enum: ["pending", "paid", "returned", "cancelled"]
        },
      }
    }
  }
});

db.marketplaceorders.createIndex({ listingId: 1 });
db.marketplaceorders.createIndex({ buyerId: 1 });
db.marketplaceorders.createIndex({ sellerId: 1 });
db.marketplaceorders.createIndex({ status: 1 });

// ─── 5. Posts (Community Feed) ───────────────────────────────────────────────

db.createCollection("posts", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["authorId", "content"],
      properties: {
        authorId:       { bsonType: "string" },
        content:        { bsonType: "string" },
        media:          { bsonType: "array", items: { bsonType: "string" } },
        hashtags:       { bsonType: "array", items: { bsonType: "string" } },
        city:           { bsonType: "string" },
        state:          { bsonType: "string" },
        country:        { bsonType: "string" },
        latitude:       { bsonType: "number" },
        longitude:      { bsonType: "number" },
        likesCount:     { bsonType: "number" },
        commentsCount:  { bsonType: "number" },
        sharesCount:    { bsonType: "number" },
        savesCount:     { bsonType: "number" },
        trendingScore:  { bsonType: "number" }
      }
    }
  }
});

db.posts.createIndex({ authorId: 1 });
db.posts.createIndex({ hashtags: 1 });
db.posts.createIndex({ trendingScore: 1 });
db.posts.createIndex({ trendingScore: -1, createdAt: -1 });
db.posts.createIndex({ createdAt: -1 });

// ─── 6. Post Likes ───────────────────────────────────────────────────────────

db.createCollection("postlikes");
db.postlikes.createIndex({ postId: 1, userId: 1 }, { unique: true });

// ─── 7. Post Saves (Bookmarks) ──────────────────────────────────────────────

db.createCollection("postsaves");
db.postsaves.createIndex({ postId: 1, userId: 1 }, { unique: true });
db.postsaves.createIndex({ userId: 1 });

// ─── 8. Comments ─────────────────────────────────────────────────────────────

db.createCollection("comments", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["postId", "authorId", "content"],
      properties: {
        postId:           { bsonType: "string" },
        authorId:         { bsonType: "string" },
        content:          { bsonType: "string" },
        parentCommentId:  { bsonType: "string", description: "For nested replies" },
        likesCount:       { bsonType: "number" },
        repliesCount:     { bsonType: "number" }
      }
    }
  }
});

db.comments.createIndex({ postId: 1 });
db.comments.createIndex({ parentCommentId: 1 });

// ─── 9. Comment Likes ────────────────────────────────────────────────────────

db.createCollection("commentlikes");
db.commentlikes.createIndex({ commentId: 1, userId: 1 }, { unique: true });

// ─── 10. Follows ─────────────────────────────────────────────────────────────

db.createCollection("follows");
db.follows.createIndex({ followerId: 1, followingId: 1 }, { unique: true });
db.follows.createIndex({ followingId: 1 });

// ─── 11. Conversations ──────────────────────────────────────────────────────

db.createCollection("conversations", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["participants"],
      properties: {
        participants:         { bsonType: "array", items: { bsonType: "string" } },
        jobId:                { bsonType: "string", description: "For job-related chats" },
        marketplaceListingId: { bsonType: "string", description: "For marketplace-related chats" },
        lastMessage:          { bsonType: "string" },
        lastMessageAt:        { bsonType: "date" }
      }
    }
  }
});

db.conversations.createIndex({ participants: 1 });

// ─── 12. Messages ────────────────────────────────────────────────────────────

db.createCollection("messages", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["conversationId", "senderId", "content"],
      properties: {
        conversationId: { bsonType: "string" },
        senderId:       { bsonType: "string" },
        content:        { bsonType: "string" },
        messageType:    { bsonType: "string", enum: ["text", "image", "file"] },
        fileUrl:        { bsonType: "string" },
        readBy:         { bsonType: "array", items: { bsonType: "string" } }
      }
    }
  }
});

db.messages.createIndex({ conversationId: 1, createdAt: 1 });

// ─── 13. Notifications ──────────────────────────────────────────────────────

db.createCollection("notifications", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["userId", "type", "title", "body"],
      properties: {
        userId:         { bsonType: "string" },
        type:           { bsonType: "string" },
        title:          { bsonType: "string" },
        body:           { bsonType: "string" },
        referenceId:    { bsonType: "string" },
        referenceType:  { bsonType: "string" },
        isRead:         { bsonType: "bool" }
      }
    }
  }
});

db.notifications.createIndex({ userId: 1, isRead: 1, createdAt: -1 });

// ─── 14. Campaigns (Admin) ──────────────────────────────────────────────────

db.createCollection("campaigns", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["title", "description", "startDate", "endDate"],
      properties: {
        title:            { bsonType: "string" },
        description:      { bsonType: "string" },
        media:            { bsonType: "array", items: { bsonType: "string" } },
        ctaText:          { bsonType: "string" },
        ctaLink:          { bsonType: "string" },
        targetType:       { bsonType: "string", enum: ["all", "location"] },
        targetCities:     { bsonType: "array", items: { bsonType: "string" } },
        targetStates:     { bsonType: "array", items: { bsonType: "string" } },
        targetCountry:    { bsonType: "string" },
        startDate:        { bsonType: "date" },
        endDate:          { bsonType: "date" },
        maxViewsPerUser:  { bsonType: "number" },
        status: {
          bsonType: "string",
          enum: ["active", "inactive", "scheduled", "expired"]
        },
        impressions:      { bsonType: "number" },
        clicks:           { bsonType: "number" }
      }
    }
  }
});

db.campaigns.createIndex({ status: 1 });

// ─── 15. Campaign Views ─────────────────────────────────────────────────────

db.createCollection("campaignviews");
db.campaignviews.createIndex({ campaignId: 1, userId: 1 }, { unique: true });

// ─── 16. Disputes ────────────────────────────────────────────────────────────

db.createCollection("disputes", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["raisedBy", "againstUserId", "type", "referenceId", "reason", "description"],
      properties: {
        raisedBy:       { bsonType: "string" },
        againstUserId:  { bsonType: "string" },
        type:           { bsonType: "string", enum: ["job", "marketplace_order"] },
        referenceId:    { bsonType: "string", description: "Job or Order _id" },
        reason:         { bsonType: "string" },
        description:    { bsonType: "string" },
        evidence:       { bsonType: "array", items: { bsonType: "string" } },
        status: {
          bsonType: "string",
          enum: ["open", "under_review", "resolved", "rejected"]
        },
        resolution:     { bsonType: "string", enum: ["refund", "force_complete", "reject"] },
        adminNotes:     { bsonType: "string" }
      }
    }
  }
});

db.disputes.createIndex({ raisedBy: 1 });
db.disputes.createIndex({ status: 1 });

print("✅ All 16 collections + indexes created successfully.");
