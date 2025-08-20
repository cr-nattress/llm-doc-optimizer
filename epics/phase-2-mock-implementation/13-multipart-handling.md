# User Story: Add Multipart Form Handling

## Story
As an API consumer, I want to upload multiple documents via multipart form data so that I can process batches of files in a single request.

## Acceptance Criteria
- [ ] Accepts multipart/form-data content type
- [ ] Handles multiple file uploads
- [ ] Validates file size limits
- [ ] Supports text and binary files
- [ ] Streams files to prevent memory overflow

## Technical Details
Implement in optimize.ts route:
```typescript
import multipart from '@fastify/multipart';

app.register(multipart, {
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10,
    fields: 5
  }
});

app.post('/optimize', async (request, reply) => {
  const parts = request.parts();
  const documents: DocumentInput[] = [];
  let optimizationType = 'clarity';
  
  for await (const part of parts) {
    if (part.type === 'file') {
      // Handle file upload
      const buffer = await streamToBuffer(part.file);
      const content = buffer.toString('utf-8');
      
      documents.push({
        name: part.filename,
        content: content,
        type: detectDocumentType(part.filename)
      });
    } else {
      // Handle form fields
      if (part.fieldname === 'optimizationType') {
        optimizationType = part.value;
      }
    }
  }
  
  if (documents.length === 0) {
    return reply.code(400).send({
      error: 'No documents provided'
    });
  }
  
  // Process documents
  const results = await documentService.processMultipleDocuments(
    documents,
    optimizationType
  );
  
  return { results };
});

async function streamToBuffer(stream: Stream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
```

## Definition of Done
- [ ] Multiple files can be uploaded
- [ ] File size limits are enforced
- [ ] Memory usage stays within bounds
- [ ] Form fields are parsed correctly